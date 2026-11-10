@EndUserText.label : 'Cost centers'
define table csks {
  key mandt     : abap.clnt not null;
  key kokrs     : abap.char(4) not null;
  key kostl     : abap.char(10) not null;
  key datbi     : abap.dats not null;
  datab         : abap.dats;
  bukrs         : abap.char(4);
  prctr         : abap.char(10);
  kosar         : abap.char(1);
  verak         : abap.char(20);
  waers         : abap.cuky;
  khinr         : abap.char(20);
  func_area     : abap.char(20);
  gsber         : abap.char(4);
  abtei         : abap.char(20);
  ktext         : abap.char(40);
}
