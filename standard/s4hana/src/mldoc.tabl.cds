@EndUserText.label : 'ML document (S/4)'
define table mldoc {
  key mandt   : abap.clnt not null;
  key docref  : abap.char(32) not null;
  key curtp   : abap.char(2) not null;
  kalnr       : abap.char(12);
  jahrper     : abap.char(20);
  quant       : abap.dec(13,3);
  stval       : abap.dec(15,2);
  bdatj       : abap.numc(4);
  categ       : abap.char(20);
  meins       : abap.unit(3);
  poper       : abap.numc(3);
  waers       : abap.cuky;
}
