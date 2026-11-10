@EndUserText.label : 'Order operation'
define table afvc {
  key mandt : abap.clnt not null;
  key aufpl : abap.numc(10) not null;
  key aplzl : abap.numc(8) not null;
  vornr     : abap.char(4);
  arbid     : abap.char(20);
  steus     : abap.char(4);
  ltxa1     : abap.char(20);
  objnr     : abap.char(22);
  rueck     : abap.numc(10);
  aufnr     : abap.char(12);
  projn     : abap.char(8);
  rmzhl     : abap.numc(8);
  werks     : abap.char(4);
}
