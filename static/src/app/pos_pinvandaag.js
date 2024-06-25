/** @odoo-module */

import { Payment } from "@point_of_sale/app/store/models";
import { patch } from "@web/core/utils/patch";
import { markup } from "@odoo/owl";

patch(Payment.prototype, {
  constructor() {
    super.constructor(...arguments);
    this.terminal_id = null;
    this.pinvandaag_ticket = null;
    this.api = null;
  },
  init_from_JSON(json) {
    super.init_from_JSON(...arguments);
    if (this.payment_method?.use_payment_terminal === "pinvandaag") {
      this.terminal_id = json.terminal_id;
      this.pinvandaag_ticket = json.pinvandaag_ticket;
      this.api = json.api;
    }
  },
  export_as_JSON() {
    const result = super.export_as_JSON(...arguments);
    if (result && this.payment_method?.use_payment_terminal === "pinvandaag") {
      return Object.assign(result, {
        terminal_id: this.terminal_id,
        pinvandaag_ticket: this.pinvandaag_ticket,
      });
    }
    return result;
  },
  set_api_type(api) {
    this.api = api;
  },
  export_for_printing() {
    const result = super.export_for_printing(...arguments);
    result.terminal_id = this.terminal_id;
    result.pinvandaag_ticket = this.pinvandaag_ticket;
    return result;
  },
  set_pinvandaag_receipt(receipt) {
    this.pinvandaag_ticket = this.construct_pinvandaag_ticket(receipt);
  },
  set_payment_status(status) {
    super.set_payment_status(status);
    // Set payment status
    this.payment_status = status;
  },
  isJson(item) {
    item = typeof item !== "string" ? JSON.stringify(item) : item;
    try {
      item = JSON.parse(item);
    } catch (e) {
      return false;
    }
    if (typeof item === "object" && item !== null) {
      return true;
    }
    return false;
  },
  construct_pinvandaag_ticket(receipt) {
    let decodedReceipt;
    if (this.isJson(receipt)) {
      decodedReceipt = JSON.parse(receipt);
    } else {
      decodedReceipt = receipt;
    }
    if (decodedReceipt.customer) {
      decodedReceipt = decodedReceipt.customer.split("\n");
    }
    if (this.api === "Worldline") {
      return markup(
        decodedReceipt
          .map((item) => {
            if (typeof item === "string") {
              const parsed = JSON.parse(item);
              return parsed
                .map((i) => {
                  return `${i[1]}<br />`;
                })
                .join(""); // Join the inner arrays
            } else {
              return `${item[1]}<br />`;
            }
          })
          .join("")
          .replace(/\r/g, "")
      );
    } else {
      return markup(
        decodedReceipt
          .map((item) => {
            const parsed = JSON.parse(item);
            return parsed
              .map((i) => {
                return `${i}<br />`;
              })
              .join(""); // Join the inner arrays
          })
          .join("")
          .replace(/\r/g, "")
      );
    }
  },
  setTerminalId(id) {
    this.terminal_id = id;
  },
});
