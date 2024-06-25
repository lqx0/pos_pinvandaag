from typing import Optional
import requests
import logging

from odoo import _

REQUEST_TIMEOUT = 10
_logger = logging.getLogger(__name__)


class PosPinvandaagRequest:
    localhost: bool = True
    http_client_session: Optional[requests.Session] = None

    def __init__(self, payment_method) -> None:
        self.pinvandaag_api_key = payment_method.pinvandaag_api_key

        # request_timeout = (
        #     self.payment_method.env["ir.config_parameter"]
        #     .sudo()
        #     .get_param("pos_pinvandaag.request_timeout", REQUEST_TIMEOUT)
        # )

        self.payment_method = payment_method

        self.http_client_session = requests.Session(timeout=REQUEST_TIMEOUT)

    def _isLocalHost(self) -> bool:
        return self.localhost

    def _pinvandaag_get_endpoints(self):
        return (
            "https://rest-api.pinvandaag.com/"
            if not self._isLocalHost()
            else "http://localhost:3006/"
        )

    def _call_pinvandaag(self, method: str, endpoint: str, payload: dict) -> dict:

        endpoint = f"{self._pinvandaag_get_endpoints()}{endpoint}"

        try:
            response = self.http_client_session.request(
                method,
                endpoint,
                json=payload,
                timeout=REQUEST_TIMEOUT,
                headers={"x-api-key": self.pinvandaag_api_key},
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            _logger.error("Error while calling Pin Vandaag API: %s", e)
            return {"error": _("Error while calling Pin Vandaag API: %s") % e}
        except ValueError as e:
            _logger.error("Error while calling Pin Vandaag API: %s", e)
            return {"error": _("Error while calling Pin Vandaag API: %s") % e}
        except Exception as e:
            _logger.error("Error while calling Pin Vandaag API: %s", e)
            return {"error": _("Error while calling Pin Vandaag API: %s") % e}
