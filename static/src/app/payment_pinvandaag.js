/** @odoo-module */

import { _t } from "@web/core/l10n/translation";
import { PaymentInterface } from "@point_of_sale/app/payment/payment_interface";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

export class PosPinVandaagPay extends PaymentInterface {
  setup() {
    super.setup(...arguments);
    this.terminal_id = null;
    this.transaction_id = null;
    this.continue_on_success = false;
  }

  set_terminal_id(id) {
    this.terminal_id = id;
    return this;
  }
  set_transaction_id(transaction_id) {
    this.transaction_id = transaction_id;
    return this;
  }
  set_continue_on_success(continue_on_success) {
    this.continue_on_success = continue_on_success;
    return this;
  }

  send_payment_request(cid) {
    super.send_payment_request(cid);
    return this.__process_pinvandaag(cid);
  }

  send_payment_cancel(order, cid) {
    super.send_payment_cancel(order, cid);
    return this.cancel_request();
  }
  async _call_pinvandaag(data) {
    return await this.env.services.orm.silent
      .call("pos.payment.method", "terminal_request", [
        [this.terminal_id],
        data,
      ])
      .catch(this._handle_odoo_connection_failure.bind(this));
  }
  async get_last_transaction_status() {
    return await this._call_pinvandaag({
      SaleToTerminal: {
        TerminalID: this.terminal_id,
        RequestType: "getLastTransaction",
      },
    });
  }

  async poll_transaction(cid) {
    const order = this.pos.get_order();
    const line = order.selected_paymentline;

    return await new Promise(async (resolve, reject) => {
      const Poller = async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        // check if the cancel request was called
        await this._call_pinvandaag({
          SaleToTerminal: {
            TerminalID: line.terminal_id,
            RequestType: "status",
            PaymentDetails: {
              TransactionId: line.transaction_id,
            },
          },
        }).then(async (respData) => {
          switch (respData.transaction.status) {
            case "success":
              if (
                respData.transaction.which_api &&
                !respData.transaction.receipt
              ) {
                // Show error with transaction aborted
                line.set_payment_status("retry");
                return reject(respData);
              }
              line.set_payment_status("done");
              line.set_api_type(respData.transaction.which_api);
              return resolve(respData);
            case "failed":
              line.set_payment_status("retry");
              return reject(respData);
            case "started":
            case "pending":
            case "unknown":
              // set the transaction id for the next poll
              this.set_transaction_id(respData.transaction.transaction_id);
              line.set_payment_status("waiting");
              return Poller();
            default:
              return Poller();
          }
        });
      };
      return Poller();
    })
      .then((respData) => {
        if (respData.transaction.status === "success") {
          this.pos
            .get_order()
            .selected_paymentline.set_pinvandaag_receipt(
              respData.transaction.receipt
            );
          return true;
        } else {
          line.set_payment_status("retry");
          return false;
        }
      })
      .catch((err) => {
        // line.set_payment_status("retry");
        this._show_error(
          "Transaction failed. Please try again.",
          "Pinvandaag Error"
        );
        return false;
      });
  }

  pending_pinvandaag_line() {
    return this.pos
      .get_order()
      .paymentlines.find(
        (paymentLine) =>
          paymentLine.payment_method.use_payment_terminal === "pinvandaag" &&
          !paymentLine.is_done()
      );
  }

  async __process_refund_pinvandaag(cid) {
    const order = this.pos.get_order();
    const line = order.selected_paymentline;

    if (!line) {
      line.set_payment_status("retry");
      this._show_error("Payment line not found");
      return;
    }

    if (order.selected_paymentline.amount == 0) {
      line.set_payment_status("retry");
      this._show_error("Select an amount above 0");
      return;
    }

    line.setTerminalId(line.payment_method.pinvandaag_terminal_identifier);
    this.set_terminal_id(line.payment_method.pinvandaag_terminal_identifier);
    this.set_continue_on_success(
      order.selected_paymentline.payment_method
        .pinvandaag_confirm_order_on_payment
    );
    return await this._call_pinvandaag({
      SaleToTerminal: {
        TerminalID: line.payment_method.pinvandaag_terminal_identifier,
        PaymentDetails: {
          Amount: line.amount,
        },
        RequestType: "refund",
      },
    })
      .then(async (res) => {
        if (res.success === false)
          return this._show_error(
            res.error ||
              "Could not start transaction (refund). Contact Pin Vandaag"
          );
        if (res.status === "started" || res.status === "start") {
          line.transaction_id = res.transaction_id;
          this.transaction_id = res.transaction_id;

          return await this.poll_transaction(cid);
        }
        return false;
      })
      .catch((e) => {
        line.set_payment_status("retry");
        this._show_error(
          "Could not start transaction. Please try again.",
          "Pinvandaag Error"
        );
        return false;
      });
  }

  async __process_pinvandaag(cid) {
    const order = this.pos.get_order();
    const line = order.selected_paymentline;

    if (!line) {
      line.set_payment_status("retry");
      this._show_error("Payment line not found");
      return;
    }

    if (order.selected_paymentline.amount == 0) {
      line.set_payment_status("retry");
      this._show_error("Select an amount above 0");
      return;
    }
    if (order.selected_paymentline.amount < 0) {
      return await this.__process_refund_pinvandaag(cid);
    }
    line.setTerminalId(line.payment_method.pinvandaag_terminal_identifier);
    this.set_terminal_id(line.payment_method.pinvandaag_terminal_identifier);
    this.set_continue_on_success(
      order.selected_paymentline.payment_method
        .pinvandaag_confirm_order_on_payment
    );
    return await this._call_pinvandaag({
      SaleToTerminal: {
        TerminalID: line.payment_method.pinvandaag_terminal_identifier,
        PaymentDetails: {
          Amount: line.amount,
        },
        RequestType: "create",
      },
    })
      .then(async (res) => {
        if (!res?.success && res.status !== "started")
          return this._show_error(
            res.error || "Could not start transaction. Contact Pin Vandaag"
          );

        line.transaction_id = res.transaction_id;
        this.transaction_id = res.transaction_id;

        return await this.poll_transaction(cid);
      })
      .catch((e) => {
        line.set_payment_status("retry");
        this._show_error(
          "Could not start transaction. Please try again.",
          "Pinvandaag Error"
        );
      });
  }
  async send_payment_cancel(order, cid) {
    super.send_payment_cancel(order, cid);
    return await this.cancel_request();
  }

  async cancel_request() {
    const order = this.pos.get_order();
    const line = order.selected_paymentline;
    await this._call_pinvandaag({
      SaleToTerminal: {
        TerminalID: line.terminal_id,
        RequestType: "cancel",
        PaymentDetails: {
          TransactionId: line.transaction_id,
        },
      },
    });
  }

  _show_error(error_msg, title) {
    this.env.services.dialog.add(AlertDialog, {
      title: title || _t("Pinvandaag Error"),
      body: error_msg,
    });
  }

  _handle_odoo_connection_failure(data) {
    // handle timeout
    var line = this.pending_pinvandaag_line();
    if (line) {
      line.set_payment_status("retry");
    }
    this._show_error(
      _t(
        "Could not connect to the Odoo server, please check your internet connection and try again."
      )
    );
    return Promise.reject(data); // prevent subsequent onFullFilled's from being called
  }
}
