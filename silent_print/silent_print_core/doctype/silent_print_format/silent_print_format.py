# -*- coding: utf-8 -*-
# Copyright (c) 2022, Roque Vera and contributors
# For license information, please see license.txt

from __future__ import unicode_literals

import frappe
from frappe.model.document import Document

from silent_print.utils.service import get_pdf_options, validate_print_type

class SilentPrintFormat(Document):
	def validate(self):
		validate_print_type(self.default_print_type)
		get_pdf_options(self)

		print_format = frappe.db.get_value(
			"Print Format", self.print_format, ["name", "disabled"], as_dict=True
		)
		if not print_format or print_format.disabled:
			frappe.throw("Select an enabled Print Format")
