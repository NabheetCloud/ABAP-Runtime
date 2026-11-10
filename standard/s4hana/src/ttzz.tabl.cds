@EndUserText.label : 'Time zones'
define table ttzz {
  key mandt      : abap.clnt not null;
  key tzone      : abap.char(6) not null;
  zonerule       : abap.char(6);
  dstrule        : abap.char(6);
  flagactive     : abap.char(1);
}
