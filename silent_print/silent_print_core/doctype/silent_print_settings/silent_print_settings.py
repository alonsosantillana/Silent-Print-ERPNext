# Copyright (c) 2022, Roque Vera and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

class SilentPrintSettings(Document):
	def validate(self):
		if self.print_user and not frappe.db.get_value("User", self.print_user, "enabled"):
			frappe.throw("The configured Print User is disabled")

		previous = self.get_doc_before_save()
		if previous and previous.print_user != self.print_user:
			self.tab_id = None
