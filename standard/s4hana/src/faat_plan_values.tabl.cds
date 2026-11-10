@EndUserText.label : 'Planned depreciation values'
define table faat_plan_values {
  key mandt : abap.clnt not null;
  key bukrs : abap.char(4) not null;
  key anln1 : abap.char(12) not null;
  key anln2 : abap.char(4) not null;
  key gjahr : abap.numc(4) not null;
  key afabe : abap.numc(2) not null;
  key poper : abap.numc(3) not null;
  @Semantics.amount.currencyCode : 'faat_plan_values.waers'
  nafap     : abap.curr(15,2);
  waers     : abap.cuky;
}
