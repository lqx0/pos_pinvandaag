import logging
import requests
from .pos_pinvandaag_request import PosPinvandaagRequest
from odoo import api, models, fields, _
from odoo.exceptions import ValidationError

from dataclasses import dataclass


_logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 10


class PosPayment(models.Model):
    _inherit = "pos.payment.method"

    pinvandaag_terminal_identifier = fields.Char(
        string="Terminal ID", help="The ID of the terminal", copy=False
    )
    pinvandaag_api_key = fields.Char(
        string="API key",
        help="The API key to use to connect with Pin Vandaag",
        copy=False,
    )
    pinvandaag_confirm_order_on_payment = fields.Boolean(
        string="Directly send to receipt",
        help="After payment is completed send to the receipt page",
        copy=False,
    )

    possibles_cases: list[str] = [
        "create",
        "status",
        "cancel",
        "getLastTransaction",
        "refund",
    ]

    host = "https://rest-api.pinvandaag.com/V2"

    http_client_session: requests.Session = requests.Session()

    def _get_payment_terminal_selection(self):
        return super(PosPayment, self)._get_payment_terminal_selection() + [
            ("pinvandaag", "Pin Vandaag")
        ]

    @api.constrains("pinvandaag_terminal_identifier")
    def _check_pinvandaag_terminal_identifier(self):
        for payment_method in self:
            if not payment_method.pinvandaag_terminal_identifier:
                continue
            existing_payment_method = self.search(
                [
                    ("id", "!=", payment_method.id),
                    (
                        "pinvandaag_terminal_identifier",
                        "=",
                        payment_method.pinvandaag_terminal_identifier,
                    ),
                ],
                limit=1,
            )
            if existing_payment_method:
                raise ValidationError(
                    ("Terminal %s is already used on payment method %s.")
                    % (
                        payment_method.pinvandaag_terminal_identifier,
                        existing_payment_method.display_name,
                    )
                )

    def __convert_amount(self, amount: str) -> int:
        # Amount must be converted to a whole int
        return int(float(amount) * 100)

    def __start_transaction(self, terminal_id: str, amount: str, api_key: str):
        converted_amount = self.__convert_amount(amount)

        try:
            answer = self.http_client_session.post(
                f"{self.host}/instore/transactions/start",
                data={
                    "terminal_id": terminal_id,
                    "amount": converted_amount,
                },
                headers={
                    # Send as formdata
                    "Content-Type": "application/x-www-form-urlencoded",
                    "x-api-key": api_key,
                },
            )
            answer.raise_for_status()

            return answer.json()
        except Exception as e:
            _logger.error("Error while starting transaction: %s", e)
            return {"success": False, "error": str(e)}

    def __poll_transaction(self, terminal_id: str, transaction_id: str, api_key: str):
        try:
            answer = self.http_client_session.post(
                f"{self.host}/instore/transactions/status",
                data={
                    "transaction_id": transaction_id,
                    "terminal_id": terminal_id,
                },
                headers={
                    "x-api-key": api_key,
                },
            )
            answer.raise_for_status()

            return answer.json()
        except Exception as e:
            _logger.error("Error while polling transaction: %s", e)
            return {"success": False, "error": str(e)}

    def __cancel_transaction(self, terminal_id: str, transaction_id: str, api_key: str):
        try:
            answer = self.http_client_session.post(
                f"{self.host}/instore/transactions/stop",
                data={
                    "transaction_id": transaction_id,
                    "terminal_id": terminal_id,
                },
                headers={
                    "x-api-key": api_key,
                },
            )
            answer.raise_for_status()

            return answer.json()
        except Exception as e:
            _logger.error("Error while polling transaction: %s", e)
            return {"success": False, "error": str(e)}

    def __last_transaction(self, terminal_id: str, api_key: str):
        try:
            answer = self.http_client_session.post(
                f"{self.host}/instore/transactions/last_transaction",
                data={
                    "terminal_id": terminal_id,
                },
                headers={
                    "x-api-key": api_key,
                },
            )
            answer.raise_for_status()

            return answer.json()
        except Exception as e:
            _logger.error("Error while polling transaction: %s", e)
            return {"success": False, "error": str(e)}

    def __refund_transaction(self, terminal_id: str, api_key: str, amount: str):
        try:
            amount_str = str(amount).replace(
                "-", ""
            )  # Convert amount to string and remove '-' if present
            amount_float = float(amount_str)  # Convert the modified string to float
            converted_amount = self.__convert_amount(amount_str)
            _logger.info("Refunding transaction %s", amount)
            answer = self.http_client_session.post(
                f"{self.host}/instore/transactions/refund",
                data={
                    "terminal_id": terminal_id,
                    "amount": converted_amount,
                },
                headers={
                    "x-api-key": api_key,
                },
            )
            json = answer.json()
            _logger.info("Refund transaction: %s", json)
            answer.raise_for_status()

            return json
        except requests.exceptions.HTTPError as e:
            response = e.response.json()
            return {
                "success": False,
                "error": response.get(
                    "message", "Unknown error occured (please contact Pin Vandaag)"
                ),
            }
        except Exception as e:
            _logger.error("Error while polling transaction: %s", e)
            return {"success": False, "error": str(e)}

    def terminal_request(self, data, operation=False):
        if "SaleToTerminal" not in data:
            raise ValidationError(_("Invalid data format"))

        terminal_id = data["SaleToTerminal"]["TerminalID"]

        request_type = data["SaleToTerminal"]["RequestType"]
        if not request_type:
            raise ValidationError(_("RequestType is required"))

        terminal = self.env["pos.payment.method"].search(
            [("pinvandaag_terminal_identifier", "=", terminal_id)]
        )

        if not terminal:
            raise ValidationError(
                ("No payment method found for terminal %s") % terminal_id
            )

        if not terminal.pinvandaag_terminal_identifier:
            raise ValidationError(
                ("No terminal identifier found for terminal %s") % terminal_id
            )

        if not terminal.pinvandaag_api_key:
            raise ValidationError(_("No API key found for terminal %s") % terminal_id)

        if request_type not in self.possibles_cases:
            raise ValidationError(_("Invalid request type"))
        match request_type:
            case "create":

                amount = (
                    data["SaleToTerminal"]["PaymentDetails"]["Amount"]
                    if "Amount" in data["SaleToTerminal"]["PaymentDetails"]
                    else None
                )

                if not amount:
                    raise ValidationError(_("Amount is required"))
                return self.__start_transaction(
                    terminal_id,
                    amount,
                    terminal.pinvandaag_api_key,
                )
            case "status":
                transaction_id = (
                    data["SaleToTerminal"]["PaymentDetails"]["TransactionId"]
                    if "TransactionId" in data["SaleToTerminal"]["PaymentDetails"]
                    else None
                )
                if not transaction_id:
                    raise ValidationError(_("TransactionId is required 2"))

                return self.__poll_transaction(
                    terminal_id,
                    transaction_id,
                    terminal.pinvandaag_api_key,
                )
            case "cancel":
                transaction_id = (
                    data["SaleToTerminal"]["PaymentDetails"]["TransactionId"]
                    if "TransactionId" in data["SaleToTerminal"]["PaymentDetails"]
                    else None
                )
                if not transaction_id:
                    raise ValidationError(_("TransactionId is required 1"))

                return self.__cancel_transaction(
                    terminal_id,
                    transaction_id,
                    terminal.pinvandaag_api_key,
                )
            case "getLastTransaction":
                return self.__last_transaction(
                    terminal_id,
                    terminal.pinvandaag_api_key,
                )
            case "refund":
                amount = (
                    data["SaleToTerminal"]["PaymentDetails"]["Amount"]
                    if "Amount" in data["SaleToTerminal"]["PaymentDetails"]
                    else None
                )
                return self.__refund_transaction(
                    terminal_id,
                    terminal.pinvandaag_api_key,
                    amount,
                )
            case _:
                raise ValidationError(_("Invalid request type"))
