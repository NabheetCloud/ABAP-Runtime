@EndUserText.label : 'Delivery header'
define table likp {
  key mandt     : abap.clnt not null;
  key vbeln     : abap.char(10) not null;
  lfart         : abap.char(20);
  vstel         : abap.char(4);
  vkorg         : abap.char(4);
  kunnr         : abap.char(10);
  kunag         : abap.char(10);
  wadat         : abap.dats;
  wadat_ist     : abap.dats;
  lfdat         : abap.dats;
  route         : abap.char(6);
  btgew         : abap.dec(13,3);
  ntgew         : abap.dec(15,3);
  gbstk         : abap.char(1);
  wbstk         : abap.char(1);
  kostk         : abap.char(1);
  fkstk         : abap.char(1);
  trsta         : abap.char(20);
  erdat         : abap.dats;
  ernam         : abap.char(12);
  vtweg         : abap.char(2);
  tragr         : abap.char(20);
  lifsk         : abap.char(2);
  gewei         : abap.unit(3);
  volum         : abap.dec(15,3);
  voleh         : abap.unit(3);
  bolnr         : abap.char(20);
  traid         : abap.char(20);
  kodat         : abap.dats;
  anzpk         : abap.int4;
  erzet         : abap.tims;
  inco1         : abap.char(3);
  lddat         : abap.dats;
  vsbed         : abap.char(2);
}
