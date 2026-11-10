@EndUserText.label : 'Customers (sales area data)'
define table knvv {
  key mandt : abap.clnt not null;
  key kunnr : abap.char(10) not null;
  key vkorg : abap.char(4) not null;
  key vtweg : abap.char(2) not null;
  key spart : abap.char(2) not null;
  waers     : abap.cuky;
  zterm     : abap.char(4);
  inco1     : abap.char(3);
  inco2     : abap.char(28);
  vsbed     : abap.char(2);
  konda     : abap.char(2);
  kalks     : abap.char(1);
  aufsd     : abap.char(2);
  loevm     : abap.char(1);
  kdgrp     : abap.char(20);
  bzirk     : abap.char(20);
  pltyp     : abap.char(20);
  ktgrd     : abap.char(20);
  vkbur     : abap.char(4);
  vkgrp     : abap.char(3);
  versg     : abap.char(20);
}
