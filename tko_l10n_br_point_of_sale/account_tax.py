# -*- encoding: utf-8 -*-
##############################################################################
#
#    OpenERP, Open Source Management Solution
#    Copyright (C) 2004-2010 Tiny SPRL (<http://tiny.be>).
#
#    Thinkopen Brasil
#    Copyright (C) Thinkopen Solutions Brasil (<http://www.tkobr.com>).
#
#    This program is free software: you can redistribute it and/or modify
#    it under the terms of the GNU Affero General Public License as
#    published by the Free Software Foundation, either version 3 of the
#    License, or (at your option) any later version.
#
#    This program is distributed in the hope that it will be useful,
#    but WITHOUT ANY WARRANTY; without even the implied warranty of
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#    GNU Affero General Public License for more details.
#
#    You should have received a copy of the GNU Affero General Public License
#    along with this program.  If not, see <http://www.gnu.org/licenses/>.
#
##############################################################################
from openerp import models, api, fields, _

class account_tax(models.Model):
    _inherit = 'account.tax'
    
    tax_code_id_tax_discount = fields.Boolean(string='Discount this Tax in Price', related='tax_code_id.tax_discount', store=True)

class account_tax_code(models.Model):
    _inherit = 'account.tax.code'

    pos_fiscal_code = fields.Selection([('I',u'Isento'),('N',u'Não tributado'),('F',u'Substituição Tributária')], default = 'I', string='Fiscal Code')
