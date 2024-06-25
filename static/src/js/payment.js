odoo.define("pos_pinvandaag.payment", function (require) {
  "use strict";

  let core = require("web.core");
  let rpc = require("web.rpc");
  let PaymentInterface = require("point_of_sale.PaymentInterface");
  const { Gui } = require("point_of_sale.Gui");
  // let Dialog = require("web.Dialog");
  // const PopupWidget = require("point_of_sale.popups");

  let _t = core._t;


  const PaymentPinvandaag = PaymentInterface.extend({
    terminal_id: null,
    transaction_id: null,
    continue_on_success: false,

    set_terminal_id: function (id) {
      this.terminal_id = id;
      return this;
    },
    set_transaction_id: function (transaction_id) {
      this.transaction_id = transaction_id;
      return this;
    },
    set_continue_on_success: function (continue_on_success) {
      this.continue_on_success = continue_on_success;
      return this;
    },

    _call_pinvandaag: async function (data) {
      return await rpc
        .query(
          {
            model: "pos.payment.method",
            method: "terminal_request",
            args: [[this.TerminalId], data],
          },
          {
            // When trying to cancel a CCV transaction
            // It takes a long time to respond
            // So we need to increase the timeout to 100 seconds
            timeout: 100000,
            shadow: true,
          }
        )
        .catch(this._handle_odoo_connection_failure.bind(this));
    },
    get_last_transaction_status: async function () {
      return await this._call_pinvandaag({
        SaleToTerminal: {
          TerminalID: this.terminal_id,
          RequestType: "getLastTransaction",
        },
      });
    },
    poll_transaction: async function () {
      const order = this.pos.get_order();
      const line = order.selected_paymentline;
      await new Promise(async (resolve, reject) => {
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
            if (respData.Status === "success") {
              const transData = respData.Response;
              if (
                transData.Status == "started" ||
                transData.Status == "pending" ||
                transData.Status == "unknown"
              ) {
                // set the transaction id for the next poll
                this.set_transaction_id(transData.TransactionID);
                line.set_payment_status("waiting");
                return Poller();
              } else if (transData.Status == "success") {
                line.set_payment_status("done");
                return resolve(transData);
              } else if (transData.Status == "failed") {
                return reject(respData);
              }
            }
            return Poller();
          });
        };
        Poller();
      })
        .then((respData) => {
          line.set_payment_status("done");
          if (this.continue_on_success) {
            // continue to the next screen
            Gui.showScreen("ReceiptScreen");
          }
          this.pos
            .get_order()
            .selected_paymentline.set_pinvandaag_receipt(respData.Receipt);
        })
        .catch((err) => {
          line.set_payment_status("retry");
          this._show_error(
            "Transaction failed. Please try again.",
            "Pinvandaag Error"
          );
        });
    },

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
      const amount_in_cents = Number(String(line.amount).replace("-", "") * 100).toFixed(0);
      if (isNaN(amount_in_cents)) {
        line.set_payment_status("retry");
        this._show_error("Invalid amount");
        return;
      }
      return await this._call_pinvandaag({
        SaleToTerminal: {
          TerminalID: line.payment_method.pinvandaag_terminal_identifier,
          PaymentDetails: {
            Amount: amount_in_cents,
          },
          RequestType: "refund",
        },
      })
        .then(async (res) => {
          if (res.Status !== "started") {
            line.set_payment_status("retry");
            this._show_error(
              "Could not start refund transaction. Please try again.",
              "Pinvandaag Error"
            );
            return false;
          }
          if (res.Status === "started") {
            const transData = res.Response;
            console.log(transData)
            line.transaction_id = transData.TransactionID;
            this.transaction_id = transData.TransactionID;

            return await this.poll_transaction();
          }
          return false;
        })
        .catch(() => {
          line.set_payment_status("retry");
          this._show_error(
            "Could not start transaction. Please try again.",
            "Pinvandaag Error"
          );
          return false;
        });
    },

    send_payment_request: async function (cid) {
      const order = this.pos.get_order();
      const line = order.selected_paymentline;
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
      console.log(line.amount)
      return await this._call_pinvandaag({
        SaleToTerminal: {
          TerminalID: line.payment_method.pinvandaag_terminal_identifier,
          PaymentDetails: {
            Amount: line.amount,
          },
          RequestType: "create",
        },
      })
        .then(async (resp) => {
          // if is success then poll the transaction
          if (resp.Status == "success") {
            const transData = resp.Response;
            line.transaction_id = transData.TransactionID;
            this.transaction_id = transData.TransactionID;
            await this.poll_transaction();
            return true;
          }
        })
        .catch((err) => {
          this._show_error(
            "Error",
            "Could not create transaction. Please try again."
          );
        });
    },

    send_payment_cancel: async function (order, cid) {
      this._super.apply(this, arguments);
      return await this.cancel_request();
    },
    cancel_request: async function () {
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
    },
    _show_error: function (msg, title) {
      if (!title) {
        title = _t("Pinvandaag Error");
      }
      Gui.showPopup("ErrorPopup", {
        title: title,
        body: msg,
      });
    },
    pending_pinvandaag_line() {
      return this.pos
        .get_order()
        .paymentlines.find(
          (paymentLine) =>
            paymentLine.payment_method.use_payment_terminal === "pinvandaag" &&
            !paymentLine.is_done()
        );
    },

    _handle_odoo_connection_failure: function (data) {
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
    },
  });

  return PaymentPinvandaag;
});

odoo.define("pos_pinvandaag.models", function (require) {
  const { register_payment_method, Payment } = require("point_of_sale.models");
  const PaymentPinVandaag = require("pos_pinvandaag.payment");
  const Registries = require("point_of_sale.Registries");
  const { markup } = owl;
  register_payment_method("pinvandaag", PaymentPinVandaag);

  const PosPinvandaagPayment = (Payment) =>
    class PosPinvandaagPayment extends Payment {
      constructor(obj, options) {
        super(...arguments);
        this.terminal_id = this.terminal_id || null;
        this.pinvandaag_ticket = this.pinvandaag_ticket || null;
      }
      //@override
      export_as_JSON() {
        console.log("export_as_JSON");
        return _.extend(super.export_as_JSON(...arguments), {
          terminal_id: this.terminal_id,
          pinvandaag_ticket: this.pinvandaag_ticket,
        });
      }
      //@override
      init_from_JSON(json) {
        super.init_from_JSON(...arguments);
        this.terminal_id = json.terminal_id;
        this.pinvandaag_ticket = json.pinvandaag_ticket;
      }
      setTerminalId(id) {
        this.terminal_id = id;
      }
      export_for_printing() {
        const result = super.export_for_printing(...arguments);
        result.terminal_id = this.terminal_id;
        result.pinvandaag_ticket = this.pinvandaag_ticket;
        return result;
      }
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
      }
      construct_pinvandaag_ticket(receipt) {
        let decodedReceipt;
        if (this.isJson(receipt)) {
          decodedReceipt = JSON.parse(receipt);
        } else {
          decodedReceipt = receipt;
        }
        return markup(
          decodedReceipt
            .map((item) => {
              if (typeof item === "string") {
                return `${item}<br />`;
              } else {
                return `${item[1]}<br />`;
              }
            })
            .join("")
            .replace(/\r/g, "")
        );
      }
      set_pinvandaag_receipt(receipt) {
        this.pinvandaag_ticket = this.construct_pinvandaag_ticket(receipt);
      }
    };

  Registries.Model.extend(Payment, PosPinvandaagPayment);
});

odoo.define("pos_pinvandaag.PaymentScreen", function (require) {
  "use strict";
  const PaymentScreen = require("point_of_sale.PaymentScreen");
  const Registries = require("point_of_sale.Registries");
  const { onMounted } = owl;
  const PosPinvandaagPaymentScreen = (PaymentScreen) =>
    class extends PaymentScreen {
      setup() {
        super.setup();
        onMounted(() => {
          const pendingPaymentLine = this.currentOrder.paymentlines.find(
            (paymentLine) =>
              paymentLine.payment_method.use_payment_terminal ===
                "pinvandaag" &&
              !paymentLine.is_done() &&
              paymentLine.get_payment_status() !== "pending"
          );
          if (pendingPaymentLine) {
            const paymentTerminal =
              pendingPaymentLine.payment_method.payment_terminal;
            paymentTerminal.set_terminal_id(
              pendingPaymentLine.payment_method.pinvandaag_terminal_identifier
            );
            paymentTerminal.set_continue_on_success(
              pendingPaymentLine.payment_method
                .pinvandaag_confirm_order_on_payment
            );
            pendingPaymentLine.set_payment_status("waiting");

            paymentTerminal
              .get_last_transaction_status()
              .then((respData) => {
                if (respData.Status === "success" && respData.Response) {
                  const lastTransData = respData.Response;
                  // set transaction id to payment line
                  if (
                    pendingPaymentLine.transaction_id !==
                      lastTransData.TransactionID &&
                    pendingPaymentLine.transaction_id != "undefined"
                  ) {
                    return pendingPaymentLine.set_payment_status("retry");
                  }
                  paymentTerminal.set_transaction_id(lastTransData.Id);

                  switch (lastTransData.Status) {
                    case "success":
                      pendingPaymentLine.set_payment_status("done");
                      break;
                    case "failed":
                      pendingPaymentLine.set_payment_status("retry");
                      break;
                    default:
                      pendingPaymentLine.set_payment_status("waiting");
                      // start polling
                      paymentTerminal.poll_transaction();
                      break;
                  }
                  return;
                }
                pendingPaymentLine.set_payment_status("retry");
              })
              .catch((err) => {
                // send a cancel request to terminal and set payment status to retry
                pendingPaymentLine.set_payment_status("retry");
              });
          }
        });
      }
    };

  Registries.Component.extend(PaymentScreen, PosPinvandaagPaymentScreen);

  return PaymentScreen;
});
