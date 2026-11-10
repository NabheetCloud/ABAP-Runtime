@EndUserText.label : 'ML period totals by currency'
define table ckmlcr {
  key mandt  : abap.clnt not null;
  key kalnr  : abap.char(12) not null;
  key bdatj  : abap.numc(4) not null;
  key poper  : abap.numc(3) not null;
  key untper : abap.numc(3) not null;
  key curtp  : abap.char(2) not null;
  pvprs      : abap.dec(15,2);
  stprs      : abap.dec(15,2);
  salk3      : abap.dec(15,2);
  peinh      : abap.dec(15,3);
  waers      : abap.cuky;
}
