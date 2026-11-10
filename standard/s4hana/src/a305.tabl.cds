@EndUserText.label : 'Customer/material with release status (access)'
define table a305 {
  key mandt : abap.clnt not null;
  key kappl : abap.char(2) not null;
  key kschl : abap.char(4) not null;
  key vkorg : abap.char(4) not null;
  key vtweg : abap.char(2) not null;
  key kunnr : abap.char(10) not null;
  key matnr : abap.char(40) not null;
  key datbi : abap.dats not null;
  datab     : abap.dats;
  knumh     : abap.char(10);
}
