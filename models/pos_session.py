# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.

from odoo import models
import logging

_logger = logging.getLogger(__name__)


class PosSession(models.Model):
    _inherit = 'pos.session'

    def _loader_params_pos_payment_method(self):
        result = super()._loader_params_pos_payment_method()
        # log the result to see what is in it
        _logger.warning('pos_pinvandaag: _loader_params_pos_payment_method')
        _logger.warning(result)
        # add the pinvandaag_terminal_identifier to the result
        _logger.warning(result['search_params']['fields'])
        # _logger.warning('pos_pinvandaag: _loader_params_pos_payment_method')
        result['search_params']['fields'].append('pinvandaag_terminal_identifier')
        result['search_params']['fields'].append(
            'pinvandaag_confirm_order_on_payment')

        return result
