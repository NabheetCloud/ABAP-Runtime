@EndUserText.label : 'Time-dependent assignments'
define table anlz {
  key mandt : abap.clnt not null;
  key bukrs : abap.char(4) not null;
  key anln1 : abap.char(12) not null;
  key anln2 : abap.char(4) not null;
  key bdatu : abap.dats not null;
  adatu     : abap.dats;
  kostl     : abap.char(10);
  werks     : abap.char(4);
  gsber     : abap.char(4);
  prctr     : abap.char(10);
  stort     : abap.char(10);
  pernr     : abap.char(8);
  raumn     : abap.char(20);
}
