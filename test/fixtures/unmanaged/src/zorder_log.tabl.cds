@EndUserText.label : 'Order event log of a consumer'
define table zorder_log {
  key client   : abap.clnt not null;
  key order_no : abap.numc(8) not null;
  note         : abap.char(60);
}
