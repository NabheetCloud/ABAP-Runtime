@EndUserText.label : 'Usage decision'
define table qave {
  key mandt      : abap.clnt not null;
  key prueflos   : abap.char(12) not null;
  key kzart      : abap.char(1) not null;
  key zaehler    : abap.numc(8) not null;
  vcode          : abap.char(4);
  vcodegrp       : abap.char(20);
  vbewertung     : abap.char(1);
  vdatum         : abap.dats;
  vname          : abap.char(40);
  vauswahlmg     : abap.char(20);
  vezeiterf      : abap.tims;
}
