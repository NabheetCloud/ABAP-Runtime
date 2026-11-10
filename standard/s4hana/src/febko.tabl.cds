@EndUserText.label : 'Bank statement header'
define table febko {
  key mandt : abap.clnt not null;
  key kukey : abap.char(8) not null;
  anwnd     : abap.char(20);
  absnd     : abap.char(20);
  aznum     : abap.char(20);
  azdat     : abap.dats;
  waers     : abap.cuky;
  @Semantics.amount.currencyCode : 'febko.waers'
  ssbtr     : abap.curr(15,2);
  esbtr     : abap.char(20);
  astat     : abap.char(20);
  bukrs     : abap.char(4);
  hbkid     : abap.char(5);
  hktid     : abap.char(5);
  @Semantics.amount.currencyCode : 'febko.waers'
  sumha     : abap.curr(15,2);
  @Semantics.amount.currencyCode : 'febko.waers'
  sumso     : abap.curr(15,2);
}
