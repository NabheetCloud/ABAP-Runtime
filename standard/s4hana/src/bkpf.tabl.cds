@EndUserText.label : 'Accounting document header'
define table bkpf {
  key mandt : abap.clnt not null;
  key bukrs : abap.char(4) not null;
  key belnr : abap.char(10) not null;
  key gjahr : abap.numc(4) not null;
  blart     : abap.char(2);
  bldat     : abap.dats;
  budat     : abap.dats;
  monat     : abap.numc(2);
  usnam     : abap.char(12);
  tcode     : abap.char(20);
  waers     : abap.cuky;
  xblnr     : abap.char(16);
  bktxt     : abap.char(25);
  awtyp     : abap.char(5);
  awkey     : abap.char(20);
  awsys     : abap.char(20);
  cpudt     : abap.dats;
  cputm     : abap.tims;
  kursf     : abap.dec(15,3);
  stblg     : abap.char(20);
  stjah     : abap.char(20);
  bstat     : abap.char(20);
  glvor     : abap.char(20);
  ldgrp     : abap.char(20);
  hwaer     : abap.cuky;
}
