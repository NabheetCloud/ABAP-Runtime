@EndUserText.label : 'Pricing procedure steps'
define table t683s {
  key mandt : abap.clnt not null;
  key kvewe : abap.char(1) not null;
  key kappl : abap.char(2) not null;
  key kalsm : abap.char(6) not null;
  key stunr : abap.numc(3) not null;
  key zaehk : abap.numc(3) not null;
  kschl     : abap.char(4);
  kofrm     : abap.char(20);
  kofra     : abap.char(20);
  kstat     : abap.char(1);
  vtext     : abap.char(40);
}
