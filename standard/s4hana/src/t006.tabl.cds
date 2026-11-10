@EndUserText.label : 'Units of measure'
define table t006 {
  key mandt   : abap.clnt not null;
  key msehi   : abap.unit(3) not null;
  dimid       : abap.char(6);
  isocode     : abap.char(3);
  andec       : abap.int2;
  primary     : abap.char(1);
  zaehl       : abap.numc(8);
  nennr       : abap.char(20);
}
