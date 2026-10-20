import base64
import re

import frappe
from frappe import _
from frappe.utils import cint


OPAQUE_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
PRINT_TYPE_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")


def _require_authenticated_user():
	if frappe.session.user == "Guest":
		frappe.throw(_("Authentication required"), frappe.AuthenticationError)


def validate_opaque_id(value, label="Identifier"):
	value = str(value or "").strip()
	if not OPAQUE_ID_PATTERN.fullmatch(value):
		frappe.throw(_("{0} is invalid").format(_(label)), frappe.ValidationError)
	return value


def validate_print_type(value, required=True):
	value = str(value or "").strip()
	if not value and not required:
		return ""
	if not PRINT_TYPE_PATTERN.fullmatch(value):
		frappe.throw(_("Print Type is invalid"), frappe.ValidationError)
	return value


def get_print_user_configuration(require_tab=True):
	print_user = frappe.db.get_single_value("Silent Print Settings", "print_user")
	if not print_user:
		frappe.throw(_("Configure the Print User in Silent Print Settings"))
	if not frappe.db.get_value("User", print_user, "enabled"):
		frappe.throw(_("The configured Print User is disabled"))

	tab_id = frappe.db.get_single_value("Silent Print Settings", "tab_id")
	if require_tab:
		tab_id = validate_opaque_id(tab_id, "Master Tab ID")

	return frappe._dict(print_user=print_user, tab_id=tab_id)


@frappe.whitelist(methods=["GET"])
def get_client_config():
	_require_authenticated_user()
	print_user = frappe.db.get_single_value("Silent Print Settings", "print_user")
	is_print_user = bool(print_user and print_user == frappe.session.user)
	tab_id = None
	if is_print_user:
		configured_tab = frappe.db.get_single_value("Silent Print Settings", "tab_id")
		if configured_tab and OPAQUE_ID_PATTERN.fullmatch(str(configured_tab)):
			tab_id = configured_tab

	return {
		"is_print_user": is_print_user,
		"has_master_tab": bool(tab_id),
		"master_tab_id": tab_id,
	}


@frappe.whitelist(methods=["POST"])
def set_master_tab(tab_id):
	_require_authenticated_user()
	configuration = get_print_user_configuration(require_tab=False)
	if frappe.session.user != configuration.print_user:
		frappe.throw(
			_("Only the configured Print User can select the master tab"),
			frappe.PermissionError,
		)

	tab_id = validate_opaque_id(tab_id, "Master Tab ID")
	frappe.db.set_single_value("Silent Print Settings", "tab_id", tab_id)
	frappe.publish_realtime(
		"update_master_tab",
		{"tab_id": tab_id},
		user=configuration.print_user,
		after_commit=True,
	)
	return {"tab_id": tab_id}


def get_silent_print_format(silent_print_format):
	if not silent_print_format or not frappe.db.exists(
		"Silent Print Format", silent_print_format
	):
		frappe.throw(_("Silent Print Format {0} does not exist").format(silent_print_format))
	return frappe.get_doc("Silent Print Format", silent_print_format)


def dimension_mm(value, label, allow_zero=False):
	raw_value = str(value or "").strip().lower()
	if raw_value.endswith("mm"):
		raw_value = raw_value[:-2].strip()
	try:
		number = float(raw_value)
	except (TypeError, ValueError):
		frappe.throw(_("{0} must be a number in millimetres").format(_(label)))

	if number < 0 or (not allow_zero and number <= 0):
		comparison = "zero or greater" if allow_zero else "greater than zero"
		frappe.throw(_("{0} must be {1}").format(_(label), _(comparison)))
	return f"{number:g}mm"


def get_pdf_options(silent_print_format):
	page_size = str(silent_print_format.get("page_size") or "A4").strip()
	if page_size != "Custom":
		return {"page-size": page_size}

	return {
		"page-width": dimension_mm(
			silent_print_format.get("custom_width"), "Custom Page Width"
		),
		"page-height": dimension_mm(
			silent_print_format.get("custom_height"), "Custom Page Height"
		),
		"margin-left": dimension_mm(
			silent_print_format.get("custom_margin_left") or 0,
			"Custom Margin Left",
			allow_zero=True,
		),
		"margin-right": dimension_mm(
			silent_print_format.get("custom_margin_right") or 0,
			"Custom Margin Right",
			allow_zero=True,
		),
		"margin-top": "0mm",
		"margin-bottom": "0mm",
	}


@frappe.whitelist()
def create_pdf(
	doctype,
	name,
	silent_print_format,
	doc=None,
	no_letterhead=0,
	letterhead=None,
):
	_require_authenticated_user()
	silent_format = get_silent_print_format(silent_print_format)
	print_format = frappe.db.get_value(
		"Print Format",
		silent_format.print_format,
		["name", "doc_type", "disabled"],
		as_dict=True,
	)
	if not print_format or print_format.disabled:
		frappe.throw(_("The configured Print Format is missing or disabled"))
	if print_format.doc_type and print_format.doc_type != doctype:
		frappe.throw(
			_("Print Format {0} does not belong to {1}").format(
				print_format.name, doctype
			)
		)

	print_doc = doc or frappe.get_doc(doctype, name)
	print_doc.check_permission("print")
	pdf = frappe.get_print(
		doctype,
		name,
		print_format.name,
		doc=print_doc,
		as_pdf=True,
		no_letterhead=cint(no_letterhead),
		letterhead=letterhead,
		pdf_options=get_pdf_options(silent_format),
	)
	return {
		"pdf_base64": base64.b64encode(pdf).decode("ascii"),
		"print_type": validate_print_type(silent_format.default_print_type),
	}


@frappe.whitelist(methods=["POST"])
def print_silently(
	doctype,
	name,
	print_format,
	print_type=None,
	job_id=None,
	qty=1,
):
	_require_authenticated_user()
	configuration = get_print_user_configuration(require_tab=True)
	silent_format = get_silent_print_format(print_format)
	effective_print_type = validate_print_type(
		print_type or silent_format.default_print_type
	)
	job_id = validate_opaque_id(job_id or frappe.generate_hash(length=32), "Job ID")
	qty = cint(qty or 1)
	if qty < 1 or qty > 20:
		frappe.throw(_("Copies must be between 1 and 20"))

	pdf = create_pdf(doctype, name, print_format)
	payload = {
		"doctype": doctype,
		"name": name,
		"print_format": print_format,
		"print_type": effective_print_type,
		"tab_id": configuration.tab_id,
		"job_id": job_id,
		"id": job_id,
		"qty": qty,
		"pdf": pdf["pdf_base64"],
	}
	frappe.publish_realtime(
		"print-silently", payload, user=configuration.print_user, after_commit=True
	)
	return {
		"queued": True,
		"job_id": job_id,
		"print_type": effective_print_type,
	}
