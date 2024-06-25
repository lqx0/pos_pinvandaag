/** @odoo-module */
import { register_payment_method } from "@point_of_sale/app/store/pos_store";
import { PosPinVandaagPay } from "@pos_pinvandaag/app/payment_pinvandaag";

register_payment_method("pinvandaag", PosPinVandaagPay);
