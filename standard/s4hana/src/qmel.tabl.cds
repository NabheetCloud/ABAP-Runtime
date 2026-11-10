@EndUserText.label : 'Notification header (PM and QM)'
define table qmel {
  key mandt    : abap.clnt not null;
  key qmnum    : abap.char(12) not null;
  qmart        : abap.char(2);
  qmtxt        : abap.char(40);
  equnr        : abap.char(18);
  tplnr        : abap.char(40);
  matnr        : abap.char(40);
  prueflos     : abap.char(12);
  aufnr        : abap.char(12);
  priok        : abap.char(20);
  qmdat        : abap.dats;
  strmn        : abap.dats;
  ltrmn        : abap.dats;
  objnr        : abap.char(22);
  ernam        : abap.char(12);
  erdat        : abap.dats;
  iwerk        : abap.char(4);
  lifnum       : abap.char(20);
  mawerk       : abap.char(20);
  mzeit        : abap.tims;
  qmcod        : abap.char(20);
  qmgrp        : abap.char(20);
  qmkat        : abap.char(20);
}
