@EndUserText.label : 'Measurement documents'
define table imrg {
  key mandt : abap.clnt not null;
  key mdocm : abap.char(20) not null;
  point     : abap.char(12);
  idate     : abap.dats;
  itime     : abap.tims;
  readg     : abap.char(20);
  recdv     : abap.dec(15,3);
  readr     : abap.char(20);
  unitr     : abap.char(20);
  recdu     : abap.char(20);
  vlcod     : abap.char(20);
}
