@EndUserText.label : 'Storage type data'
define table mlgt {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key lgnum : abap.char(3) not null;
  key lgtyp : abap.char(3) not null;
  lgpla     : abap.char(20);
  minbe     : abap.dec(13,3);
  maxbe     : abap.char(20);
  lpmax     : abap.dec(13,3);
  lpmin     : abap.dec(13,3);
}
