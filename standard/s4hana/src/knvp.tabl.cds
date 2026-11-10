@EndUserText.label : 'Customer partner functions'
define table knvp {
  key mandt : abap.clnt not null;
  key kunnr : abap.char(10) not null;
  key vkorg : abap.char(4) not null;
  key vtweg : abap.char(2) not null;
  key spart : abap.char(2) not null;
  key parvw : abap.char(2) not null;
  key parza : abap.numc(3) not null;
  kunn2     : abap.char(20);
  lifnr     : abap.char(10);
  pernr     : abap.char(8);
}
