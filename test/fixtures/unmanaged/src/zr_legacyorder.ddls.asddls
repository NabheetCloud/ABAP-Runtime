@EndUserText.label: 'Legacy order'
define root view entity ZR_LegacyOrder as select from zlegacy_ord
{
      @UI.lineItem: [{ position: 10 }]
  key order_no   as OrderNo,
      @UI.lineItem: [{ position: 20 }]
      customer   as Customer,
      @UI.lineItem: [{ position: 30 }]
      amount     as Amount,
      @UI.lineItem: [{ position: 40 }, { type: #FOR_ACTION, dataAction: 'close', label: 'Close' }]
      status     as Status,
      changed_at as ChangedAt
}
