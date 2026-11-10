@EndUserText.label : 'Profit centers'
define table cepc {
  key mandt   : abap.clnt not null;
  key prctr   : abap.char(10) not null;
  key datbi   : abap.dats not null;
  key kokrs   : abap.char(4) not null;
  datab       : abap.dats;
  bukrs       : abap.char(4);
  verak       : abap.char(20);
  segment     : abap.char(10);
  khinr       : abap.char(20);
  abtei       : abap.char(20);
}
