@EndUserText.label : 'Cost center / activity type'
define table cssl {
  key mandt  : abap.clnt not null;
  key kokrs  : abap.char(4) not null;
  key objnr  : abap.char(22) not null;
  key gjahr  : abap.numc(4) not null;
  key lstar  : abap.char(6) not null;
  @Semantics.amount.currencyCode : 'cssl.waers'
  tkg001     : abap.curr(15,2);
  waers      : abap.cuky;
}
