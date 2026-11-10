@EndUserText.label : 'Check register'
define table payr {
  key mandt : abap.clnt not null;
  key zbukr : abap.char(4) not null;
  key hbkid : abap.char(5) not null;
  key hktid : abap.char(5) not null;
  key rzawe : abap.char(1) not null;
  key chect : abap.char(13) not null;
  vblnr     : abap.char(10);
  gjahr     : abap.numc(4);
  rwbtr     : abap.dec(15,2);
  zaldt     : abap.dats;
  voidr     : abap.char(20);
  laufd     : abap.dats;
  laufi     : abap.char(6);
  lifnr     : abap.char(10);
  waers     : abap.cuky;
  znme1     : abap.char(20);
}
