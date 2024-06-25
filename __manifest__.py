{
    "name": "POS Pin Vandaag",
    "summary": "Make payments happen with CCV/WorldLine terminals inside the POS Pinvandaag module",
    "website": "https://www.pinvandaag.nl",
    "version": "17.0",
    "category": "Sales/Point of Sale",
    "description": "",
    "sequence": 6,
    "depends": ["base_setup", "point_of_sale"],
    "data": [
        "views/pos_payment_method_views.xml",
        "views/res_config_settings_view.xml",
    ],
    "assets": {
        "point_of_sale._assets_pos": [
            "pos_pinvandaag/static/**/*",
        ],
    },
    "images": [
        "static/description/thumbnail.gif",
        "static/description/terminal_settings_thumbnail.png",
        "static/description/terminal_settings_thumbnail.png",
    ],
    "license": "LGPL-3",
    "installabe": True,
    "application": True,
    "auto_install": False,
}
