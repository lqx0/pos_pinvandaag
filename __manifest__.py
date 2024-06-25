# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'POS Pin Vandaag',
    'author': "Pin Vandaag B.V.",
    'website': 'https://www.pinvandaag.nl',
    'version': '16.0.6',
    'category': 'Sales/Point of Sale',
    'sequence': 6,
    'summary': 'Make payments happen with CCV/WorldLine terminals inside the POS Pinvandaag module',
    'description': '',
    'data': [
        # 'views/pos_config_views.xml',
        'views/pos_payment_method_views.xml',
        'views/res_config_setting_views.xml',
    ],
    'depends': ['base_setup','point_of_sale'],
    'installable': True,
    'auto_install': False,
    'images': [
        'static/description/thumbnail.gif',
    ],
    'assets': {
        'point_of_sale.assets': {
            'pos_pinvandaag/static/**/*',
        },
    },
    'license': 'LGPL-3',
}
