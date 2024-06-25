/** @odoo-module */

import { PaymentScreen } from "@point_of_sale/app/screens/payment_screen/payment_screen";
import { patch } from "@web/core/utils/patch";
import { onMounted } from "@odoo/owl";

patch(PaymentScreen.prototype, {
  setup() {
    super.setup(...arguments);
    onMounted(async () => {
      const pendingPaymentLine = this.currentOrder.paymentlines.find(
        (paymentLine) =>
          paymentLine.payment_method.use_payment_terminal === "pinvandaag" &&
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
          pendingPaymentLine.payment_method.pinvandaag_confirm_order_on_payment
        );
        pendingPaymentLine.set_payment_status("waiting");

        paymentTerminal
          .get_last_transaction_status()
          .then((respData) => {
            if (respData?.success) {
              if (
                pendingPaymentLine.transaction_id != respData.transaction_id &&
                pendingPaymentLine.transaction_id != "undefined"
              ) {
                return pendingPaymentLine.set_payment_status("retry");
              }
              paymentTerminal.set_transaction_id(respData.transaction_id);

              switch (respData.status) {
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
            console.error(err);
            pendingPaymentLine.set_payment_status("retry");
          });
      }
    });
  },
});
