# coding: utf-8
# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import logging
import pprint
import random
import requests
import string
import markupsafe
from werkzeug.exceptions import Forbidden

from odoo import fields, models, api, _
from odoo.exceptions import ValidationError
from odoo.addons.pos_pinvandaag.const import API_URL, API_ENDPOINTS

_logger = logging.getLogger(__name__)


class PosPaymentMethod(models.Model):
    _inherit = 'pos.payment.method'

    def _get_payment_terminal_selection(self):
        return super(PosPaymentMethod, self)._get_payment_terminal_selection() + [('pinvandaag', 'Pin Vandaag')]

    # Pin vandaag
    pinvandaag_terminal_identifier = fields.Char(
        string="Terminal ID",
        help='The ID of the terminal',
        copy=False
    )
    pinvandaag_api_key = fields.Char(
        string="API key",
        help="The API key to use to connect with Pin Vandaag",
        copy=False
    )
    pinvandaag_confirm_order_on_payment = fields.Boolean(
        string="Directly send to receipt",
        help="After payment is completed send to the receipt page",
        copy=False
    )

    @api.constrains('pinvandaag_terminal_identifier')
    def _check_pinvandaag_terminal_identifier(self):
        for payment_method in self:
            if not payment_method.pinvandaag_terminal_identifier:
                continue
            existing_payment_method = self.search(
                [
                    ('id', '!=', payment_method.id),
                    ('pinvandaag_terminal_identifier', '=',
                     payment_method.pinvandaag_terminal_identifier)
                ],
                limit=1
            )
            if existing_payment_method:
                raise ValidationError(_('Terminal %s is already used on payment method %s.')
                                      % (payment_method.pinvandaag_terminal_identifier, existing_payment_method.display_name))

    def _send_api_request(self, endpoint, payload):
        url = API_URL + endpoint
        response = requests.request(
            "POST",
            url,
            data=payload,
            timeout=60
        )
        return response

    def terminal_request(self, data, operation=False):
        # check if SaleToTerminal isset
        if 'SaleToTerminal' not in data:
            raise ValidationError(_('SaleToTerminal not set'))

        # get the terminalId
        terminal_id = data['SaleToTerminal']['TerminalID']
        # get the terminal
        terminal = self.env['pos.payment.method'].search(
            [('pinvandaag_terminal_identifier', '=', terminal_id)])
        # get the request type
        request_type = data['SaleToTerminal']['RequestType']

        # check if terminal is set
        if not terminal:
            raise ValidationError(_('Terminal not found'))
        # check if terminal has a api key
        if not terminal.pinvandaag_api_key:
            raise ValidationError(_('Terminal has no api key'))
        # check if request type is set
        if not request_type:
            raise ValidationError(_('Request type not found'))

        if data['SaleToTerminal']["RequestType"] == 'create':
            amount = data['SaleToTerminal']['PaymentDetails']["Amount"]
            # amount is in cents
            amount = int(amount * 100)
            # create the payload
            payload = {
                'terminalId': terminal_id,
                'key': terminal.pinvandaag_api_key,
                'amount': amount
            }
            # get the create eindpoint
            endpoint = API_ENDPOINTS['instore']['transactions']['create']
            # send the request
            response = self._send_api_request(endpoint, payload)
            # check if response is ok
            if response.status_code != 200:
                raise ValidationError(_('Response is not ok'))
            # get the response
            response = response.json()
            # check if response is ok
            if response['status'] != 'started' and response['status'] != 'pending':
                raise ValidationError(_('Response is not ok'))

            return {
                'TerminalID': terminal_id,
                'RequestType': 'create',
                'Status': 'success',
                'Response': {
                    'Status': response['status'],
                    'TransactionID': response['transactionId'],
                    'CreatedAt': response['createdAt'],
                    'Amount': amount,
                }
            }
        elif data['SaleToTerminal']["RequestType"] == 'status':
            transaction_id = data['SaleToTerminal']['PaymentDetails']['TransactionId']
            if not transaction_id:
                raise ValidationError(_('Transaction id not found'))
            # create the payload
            payload = {
                'terminalId': terminal_id,
                'key': terminal.pinvandaag_api_key,
                'transactionId': transaction_id
            }
            # get the status eindpoint
            endpoint = API_ENDPOINTS['instore']['transactions']['status']
            # send the request
            response = self._send_api_request(endpoint, payload)
            # check if response is ok
            if response.status_code != 200:
                raise ValidationError(_('Response is not ok'))
            # get the response
            response = response.json()
            # check if transaction status is failed
            if response['status'] == 'failed':
                raise ValidationError(_('Transaction failed'))

            return {
                'TerminalID': terminal_id,
                'RequestType': 'status',
                'Status': 'success',
                'Response': {
                    'Status': response['status'] if 'status' in response else "pending",
                    'TransactionID': response['transactionId'] if 'transactionId' in response else payload["transactionId"],
                    'CreatedAt': response['createdAt'] if 'createdAt' in response else None,
                    'Amount': response['amount'] if 'amount' in response else None,
                    'ErrorMsg': response['errorMsg'] if 'errorMsg' in response else None,
                    'Receipt': response['receipt'] if 'receipt' in response else None,
                    'paymentUrl': response["paymentUrl"] if "paymentUrl" in response else None,
                    'resp': response
                }
            }
        elif data['SaleToTerminal']["RequestType"] == 'cancel':
            # create the payload
            payload = {
                'terminalId': terminal_id,
                'key': terminal.pinvandaag_api_key,
                'transactionId': data['SaleToTerminal']['PaymentDetails']['TransactionId'] if 'TransactionId' in data['SaleToTerminal']['PaymentDetails'] else None,
            }
            # get the cancel eindpoint
            endpoint = API_ENDPOINTS['instore']['terminal']['cancel']
            # send the request
            response = self._send_api_request(endpoint, payload)
            # check if response is ok
            if response.status_code != 200:
                raise ValidationError(_('Response is not ok'))
            # get the response
            response = response.json()
            if response['status'] != 'success':
                raise ValidationError(_('Response is not ok'))
            return {
                'TerminalId': terminal_id,
                'RequestType': 'cancel',
                'Status': 'success',
            }
        elif data['SaleToTerminal']["RequestType"] == 'getLastTransaction':
            # create the payload
            payload = {
                'terminalId': terminal_id,
                'key': terminal.pinvandaag_api_key,
            }
            endpoint = API_ENDPOINTS['instore']['transactions']['getLatestTransaction']
            response = self._send_api_request(endpoint, payload)
            # check if response is ok
            if response.status_code != 200:
                raise ValidationError(_('Response is not ok'))
            # get the response
            response = response.json()
            if response['status'] != 'success':
                raise ValidationError(_('Response is not ok'))
        elif data['SaleToTerminal']["RequestType"] == 'refund':
            # create the payload
            # Check if amount is set
            if 'Amount' not in data['SaleToTerminal']['PaymentDetails']:
                raise ValidationError(_('Amount not set'))
            payload = {
                'terminalId': terminal_id,
                'key': terminal.pinvandaag_api_key,
                'amount': data['SaleToTerminal']['PaymentDetails']['Amount'],
            }
            endpoint = API_ENDPOINTS['instore']['transactions']['refund']
            response = self._send_api_request(endpoint, payload)
            # check if response is ok
            if response.status_code != 200:
                raise ValidationError(_('Response is not ok'))
            # get the response
            response = response.json()
            print(response)
            if response['status'] != 'started':
                raise ValidationError(_('Response is not ok'))

            return {
                'TerminalId': terminal_id,
                'RequestType': 'refund',
                'Status': 'started',
                'Response': {
                    'Status': response['status'],
                    'TransactionID': response['transactionId'],
                    'CreatedAt': response['createdAt'],
                    'Amount': response['amount'],
                    'resp': response
                }
            }
