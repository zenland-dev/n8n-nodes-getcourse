import type { INodePropertyOptions } from 'n8n-workflow';

/**
 * The fixed dictionaries of the legacy API.
 *
 * These are platform-wide codes, identical in every account, so they are lists
 * in the interface rather than dropdowns that cost a request. They come from
 * getcourse.ru/help/api; where a code is marked deprecated there, the label says
 * so rather than hiding it — an old workflow may still be sending it.
 *
 * The three status vocabularies below were checked against a live account, which
 * publishes each of them in the error it answers an unknown value with. The user
 * and order lists were wrong and are now corrected; the payment list already
 * matched the service exactly. There is no such error for the payment methods or
 * the currencies, so those two remain as the help page has them.
 *
 * Every list is sorted by the label the user sees, which is also what the n8n
 * linter insists on.
 */

/** `deal_status` — Коды статусов заказа. */
export const DEAL_STATUSES: INodePropertyOptions[] = [
	{ name: 'Cancelled (Отменен)', value: 'cancelled' },
	{
		name: 'Completed (Завершен)',
		value: 'payed',
		description: 'Creates a payment on the order, exactly as deal_is_paid does',
	},
	{ name: 'Deferred (Отложен)', value: 'pending' },
	{ name: 'False (Ложный)', value: 'false' },
	{ name: 'In Progress (В работе)', value: 'in_work' },
	{ name: 'New (Новый)', value: 'new' },
	{ name: 'Not Confirmed (Не подтвержден)', value: 'not_confirmed' },
	{ name: 'Partly Paid (Частично оплачен)', value: 'part_payed' },
	{ name: 'Waiting for Payment (Ожидаем оплаты)', value: 'payment_waiting' },
	{ name: 'Waiting for Refund (Ожидаем возврата)', value: 'waiting_for_return' },
];

/**
 * The statuses the order export filter accepts.
 *
 * The help page lists nine for `GET /pl/api/account/deals` and leaves `false`
 * out, so this list used to drop it. A live account says otherwise: an invalid
 * status is answered with `error_code 913` and the whole accepted vocabulary,
 * and `false` is in it —
 * `new,in_work,not_confirmed,payed,cancelled,false,payment_waiting,part_payed,waiting_for_return,pending`,
 * which is exactly the ten in {@link DEAL_STATUSES}. Withholding a value the
 * server accepts only hides orders the user asked for, so the export offers all
 * ten and the two lists are deliberately the same.
 */
export const DEAL_STATUSES_FOR_EXPORT: INodePropertyOptions[] = DEAL_STATUSES;

/** `payment_status` — Коды статусов платежей. */
export const PAYMENT_STATUSES: INodePropertyOptions[] = [
	{ name: 'Accepted (Получен)', value: 'accepted' },
	{ name: 'Expected (Ожидается)', value: 'expected' },
	{ name: 'From Balance (Списание с баланса)', value: 'frombalance' },
	{ name: 'Returned (Возвращен)', value: 'returned' },
	{ name: 'Returned to Balance (Начисление на депозит)', value: 'returned_to_balance' },
	{ name: 'To Balance (Пополнение баланса)', value: 'tobalance' },
];

/** `payment_type` — Коды методов оплаты. */
export const PAYMENT_TYPES: INodePropertyOptions[] = [
	{ name: '2Checkout', value: '2CO' },
	{ name: 'Alfa-Bank (Альфа-банк)', value: 'ALFA' },
	{ name: 'Bank Card (Банковской картой)', value: 'CARD' },
	{ name: 'Bank Card via Terminal (Банковская карта через терминал)', value: 'CARD_TERMINAL' },
	{ name: 'Bank Receipt (Квитанция в банк)', value: 'kvit' },
	{ name: 'Bank Transfer (Безналичный расчёт)', value: 'BILL' },
	{ name: 'BePaid', value: 'bepaid' },
	{ name: 'Bonus Account (Бонусный счет)', value: 'VIRTUAL' },
	{ name: 'Cash (Наличные)', value: 'CASH' },
	{ name: 'CloudPayments', value: 'cloud_payments' },
	{ name: 'CloudPayments KZ', value: 'cloud_payments_kz' },
	{ name: 'EBANX', value: 'ebanx' },
	{ name: 'Fondy', value: 'fondy' },
	{ name: 'Hutki Grosh', value: 'hutki_grosh' },
	{ name: 'Interkassa (Интеркасса)', value: 'interkassa' },
	{ name: 'Internal Balance (Внутренний баланс)', value: 'INTERNAL' },
	{ name: 'Justclick', value: 'justclick' },
	{ name: 'MandarinPay', value: 'mandarinpay' },
	{ name: 'Other (Другое)', value: 'OTHER' },
	{ name: 'PayAnyWay', value: 'payanyway' },
	{ name: 'PayPal', value: 'PAYPAL' },
	{ name: 'Perfect Money', value: 'perfect_money' },
	{ name: 'Perfect Money (Legacy Code)', value: 'PERFECTMONEY' },
	{ name: 'Platim.ru', value: 'platim' },
	{ name: 'Qiwi (Deprecated)', value: 'QIWI' },
	{ name: 'QIWI Kassa', value: 'qiwi_kassa' },
	{ name: 'Quick Transfer Systems (Системы быстрых переводов)', value: 'QUICKTRANSFER' },
	{ name: 'RBK Money (РБК Деньги)', value: 'RBK' },
	{ name: 'RBK Money 2018', value: 'rbkmoney_new' },
	{ name: 'RBK Money (Deprecated)', value: 'rbkmoney' },
	{ name: 'Robokassa (Робокасса)', value: 'ROBOKASSA' },
	{ name: 'Sberbank (Sberbank)', value: 'SBER' },
	{ name: 'Sberbank Acquiring (Сбербанк эквайринг)', value: 'sberbank' },
	{ name: 'Stripe', value: 'stripe' },
	{ name: 'Swedbank', value: 'swedbank' },
	{ name: 'Tinkoff Bank (Тинькофф Банк)', value: 'tinkoff' },
	{ name: 'Tinkoff Credit (Тинькофф Кредит)', value: 'tinkoffcredit' },
	{ name: 'Walletone (Единая касса)', value: 'walletone' },
	{ name: 'WayForPay', value: 'wayforpay' },
	{ name: 'Webmoney', value: 'WEBMONEY' },
	{ name: 'Yandex.Kassa (Яндекс.Касса)', value: 'yandex_kassa' },
	{ name: 'Yandex.Money (Яндекс.Деньги)', value: 'YANDEXMONEY' },
	{ name: 'Z-Payment', value: 'zpayment' },
];

/**
 * `deal_currency` — Коды валют.
 *
 * The help page lists 33; the account interface publishes more, so the field
 * that uses this list stays free-text-friendly through an expression.
 */
export const CURRENCIES: INodePropertyOptions[] = [
	'AED',
	'AMD',
	'AUD',
	'AZN',
	'BRL',
	'BYN',
	'BYR',
	'CAD',
	'CHF',
	'CZK',
	'DKK',
	'EUR',
	'GBP',
	'ILS',
	'INR',
	'JPY',
	'KGS',
	'KZT',
	'MNT',
	'MXN',
	'MYR',
	'NZD',
	'PLN',
	'RON',
	'RSD',
	'RUB',
	'SEK',
	'SGD',
	'TRY',
	'UAH',
	'USD',
	'UZS',
	'ZAR',
].map((code) => ({ name: code, value: code }));

/**
 * `status` — the user states the export filter accepts.
 *
 * All five come from the service itself: sending a status it does not know is
 * answered with `error_code 914` and the list in full —
 * «попробуйте один из - active,deactivated,banned,invited,in_base». The help
 * page documents only two of them, which is what this list used to hold; the
 * other three were unreachable through the node even though the export accepts
 * them. Orders and payments have their own, different vocabularies (913 and 918).
 */
export const USER_STATUSES: INodePropertyOptions[] = [
	{ name: 'Active (Активные)', value: 'active' },
	{ name: 'Banned (Заблокированные)', value: 'banned' },
	{ name: 'Deactivated (Отключенные)', value: 'deactivated' },
	{ name: 'In Base (В базе)', value: 'in_base' },
	{ name: 'Invited (Приглашенные)', value: 'invited' },
];
