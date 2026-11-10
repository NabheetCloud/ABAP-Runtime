@EndUserText.label : 'WBS hierarchy'
define table prhi {
  key mandt : abap.clnt not null;
  key posnr : abap.numc(6) not null;
  psphi     : abap.char(8);
  up        : abap.char(8);
  down      : abap.char(8);
  left      : abap.char(8);
  right     : abap.char(8);
}
