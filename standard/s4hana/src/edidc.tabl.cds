@EndUserText.label : 'IDoc control record'
define table edidc {
  key mandt  : abap.clnt not null;
  key docnum : abap.char(16) not null;
  status     : abap.char(2);
  direct     : abap.char(20);
  mestyp     : abap.char(30);
  idoctp     : abap.char(30);
  rcvprn     : abap.char(20);
  sndprn     : abap.char(20);
  credat     : abap.dats;
  cretim     : abap.tims;
  rcvprt     : abap.char(20);
  upddat     : abap.dats;
}
