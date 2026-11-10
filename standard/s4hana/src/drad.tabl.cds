@EndUserText.label : 'DMS object links'
define table drad {
  key mandt : abap.clnt not null;
  key dokar : abap.char(3) not null;
  key doknr : abap.char(25) not null;
  key dokvr : abap.char(2) not null;
  key doktl : abap.char(3) not null;
  key dokob : abap.char(10) not null;
  key obzae : abap.numc(4) not null;
  objky     : abap.char(30);
}
