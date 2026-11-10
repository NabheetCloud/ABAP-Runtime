@EndUserText.label : 'Handling unit header'
define table vekp {
  key mandt    : abap.clnt not null;
  key venum    : abap.char(10) not null;
  vepos        : abap.numc(6);
  exidv        : abap.char(20);
  vhilm        : abap.char(40);
  brgew        : abap.dec(15,3);
  vbeln        : abap.char(10);
  posnr        : abap.numc(6);
  matnr        : abap.char(40);
  vemng        : abap.dec(13,3);
  gewei        : abap.unit(3);
  vpobj        : abap.char(20);
  vpobjkey     : abap.char(20);
  werks        : abap.char(4);
}
