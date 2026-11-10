@EndUserText.label : 'Main asset number'
define table anlh {
  key mandt   : abap.clnt not null;
  key bukrs   : abap.char(4) not null;
  key anln1   : abap.char(12) not null;
  anlhtxt     : abap.char(40);
  lanep       : abap.int4;
}
