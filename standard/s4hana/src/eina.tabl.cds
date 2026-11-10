@EndUserText.label : 'Purchasing info record general'
define table eina {
  key mandt : abap.clnt not null;
  key infnr : abap.char(10) not null;
  matnr     : abap.char(40);
  lifnr     : abap.char(10);
  matkl     : abap.char(9);
  meins     : abap.unit(3);
  idnlf     : abap.char(35);
  erdat     : abap.dats;
  ernam     : abap.char(12);
}
