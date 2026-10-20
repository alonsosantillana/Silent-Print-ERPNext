from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from silent_print.utils.service import (
	get_pdf_options,
	print_silently,
	set_master_tab,
	validate_print_type,
)


class TestSilentPrintService(FrappeTestCase):
	def test_custom_pdf_dimensions_are_normalized_to_mm(self):
		options = get_pdf_options(frappe._dict(
			page_size="Custom",
			custom_width="80",
			custom_height="330mm",
			custom_margin_left="0",
			custom_margin_right="2.5",
		))

		self.assertEqual(options["page-width"], "80mm")
		self.assertEqual(options["page-height"], "330mm")
		self.assertEqual(options["margin-left"], "0mm")
		self.assertEqual(options["margin-right"], "2.5mm")

	def test_print_type_rejects_untrusted_characters(self):
		self.assertRaises(frappe.ValidationError, validate_print_type, "ORDER;DROP")

	@patch("silent_print.utils.service.get_print_user_configuration")
	def test_non_print_user_cannot_select_master_tab(self, get_configuration):
		get_configuration.return_value = frappe._dict(
			print_user="printer@example.com", tab_id=None
		)
		with patch(
			"silent_print.utils.service.frappe.session",
			frappe._dict(user="cashier@example.com"),
		):
			self.assertRaises(frappe.PermissionError, set_master_tab, "valid-tab")

	@patch("silent_print.utils.service.frappe.publish_realtime")
	@patch("silent_print.utils.service.create_pdf")
	@patch("silent_print.utils.service.get_silent_print_format")
	@patch("silent_print.utils.service.get_print_user_configuration")
	def test_explicit_print_type_and_job_id_are_preserved(
		self, get_configuration, get_format, create_pdf, publish_realtime
	):
		get_configuration.return_value = frappe._dict(
			print_user="printer@example.com", tab_id="master-tab"
		)
		get_format.return_value = frappe._dict(default_print_type="ORDER")
		create_pdf.return_value = {"pdf_base64": "UERG", "print_type": "ORDER"}

		result = print_silently(
			"Table Order",
			"OR-TEST",
			"Order Account",
			print_type="ACCOUNT",
			job_id="job-1",
		)

		self.assertEqual(result["job_id"], "job-1")
		self.assertEqual(result["print_type"], "ACCOUNT")
		payload = publish_realtime.call_args.args[1]
		self.assertEqual(payload["id"], "job-1")
		self.assertEqual(payload["print_type"], "ACCOUNT")
		self.assertEqual(publish_realtime.call_args.kwargs["user"], "printer@example.com")
