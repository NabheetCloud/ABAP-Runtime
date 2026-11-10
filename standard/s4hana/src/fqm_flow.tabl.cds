@EndUserText.label : 'One Exposure cash flows'
define table fqm_flow {
  key mandt      : abap.clnt not null;
  key flow_id    : abap.char(20) not null;
  bukrs          : abap.char(4);
  @Semantics.amount.currencyCode : 'fqm_flow.waers'
  amount         : abap.curr(15,2);
  currency       : abap.cuky;
  date           : abap.char(20);
  flow_type      : abap.char(4);
  waers          : abap.cuky;
  value_date     : abap.dats;
  origin         : abap.char(10);
}
