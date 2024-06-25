# Part of Odoo. See LICENSE file for full copyright and licensing details.

# API URL
API_URL = 'https://rest-api.pinvandaag.com/V1/'
API_ENDPOINTS = dict({
    'instore': {
        'transactions': {
            'create': 'instore/transactions/create',
            'status': 'instore/transactions/status',
            'mailreceipt': 'instore/transactions/mailreceipt',
            'date': 'instore/transactions/date',
            'refund': 'instore/transactions/refund',
            'getLatestTransaction': 'instore/transactions/getLatestTransaction',
        },
        'terminal': {
            'status': 'instore/terminal/status',
            'ctmp': 'instore/terminal/ctmp',
            'cancel': 'instore/terminal/cancel',
        },
    },
})
