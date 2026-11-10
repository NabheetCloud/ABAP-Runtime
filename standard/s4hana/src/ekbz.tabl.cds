@EndUserText.label : 'PO history delivery costs'
define table ekbz {
  key mandt : abap.clnt not null;
  key ebeln : abap.char(10) not null;
  key ebelp : abap.numc(5) not null;
  key stunr : abap.numc(3) not null;
  key zaehk : abap.numc(3) not null;
  key vgabe : abap.char(1) not null;
  key gjahr : abap.numc(4) not null;
  key belnr : abap.char(10) not null;
  key buzei : abap.numc(3) not null;
  bewtp     : abap.char(1);
  @Semantics.amount.currencyCode : 'ekbz.waers'
  dmbtr     : abap.curr(15,2);
  menge     : abap.dec(13,3);
  waers     : abap.cuky;
}
