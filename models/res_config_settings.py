from odoo import fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    module_pos_pinvandaag = fields.Boolean(string="Pinvandaag Terminal",
                                           help="The transactions are processed by payment terminal. Set your terminal credentials on the related payment method.")

    def set_values(self):
        super(ResConfigSettings, self).set_values()
        payment_method = self.env['pos.payment.method']
        if not self.env['ir.config_parameter'].sudo().get_param('pos_pinvandaag.module_pos_pinvandaag'):
            payment_method |= payment_method.search(
                [('use_payment_terminal', '=', 'pinvandaag')])
            payment_method.write({'use_payment_terminal': False})
