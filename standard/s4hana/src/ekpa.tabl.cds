@EndUserText.label : 'Partner roles in purchasing'
define table ekpa {
  key mandt : abap.clnt not null;
  key ebeln : abap.char(10) not null;
  key ekorg : abap.char(4) not null;
  key ltsnr : abap.char(6) not null;
  key werks : abap.char(4) not null;
  key parvw : abap.char(2) not null;
  key parza : abap.numc(3) not null;
  lifn2     : abap.char(10);
}
