@EndUserText.label : 'Document pricing elements (replaces KONV)'
define table prcd_elements {
  key mandt : abap.clnt not null;
  key knumv : abap.char(10) not null;
  key kposn : abap.numc(6) not null;
  key stunr : abap.numc(3) not null;
  key zaehk : abap.numc(3) not null;
  kschl     : abap.char(4);
  kbetr     : abap.dec(15,3);
  kpein     : abap.dec(15,3);
  kmein     : abap.unit(3);
  @Semantics.amount.currencyCode : 'prcd_elements.waers'
  kwert     : abap.curr(15,2);
  waers     : abap.cuky;
  @Semantics.amount.currencyCode : 'prcd_elements.waers'
  kawrt     : abap.curr(15,2);
  kinak     : abap.char(1);
  kstat     : abap.char(1);
  knumh     : abap.char(10);
  koaid     : abap.char(1);
  kntyp     : abap.char(20);
  kherk     : abap.char(20);
}
