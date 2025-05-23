// $License: NOLICENSE
//--------------------------------------------------------------------------------
/**
  @file $relPath
  @copyright $copyright
  @author sofiane boukhezzar
*/

//--------------------------------------------------------------------------------
// Libraries used (#uses)
#uses "cns"


//--------------------------------------------------------------------------------
// Variables and Constants


//--------------------------------------------------------------------------------
//@public members
//--------------------------------------------------------------------------------
MqttTopicsImporterAndCNScreator(anytype atData, dyn_dyn_anytype ddaQRes, string sConnectionName)
{
  dyn_dyn_string xxdepes1, xxdepes2, xxdepes3;
  dyn_dyn_int xxdepei1, xxdepei2, xxdepei3;
  string sPath = getPath(SOURCE_REL_PATH);
  string sFile;
  dyn_string dsFile;

  // Check if the query result contains more than just the header
  if(dynlen(ddaQRes) == 1)
    return;

  // Open the file which contains the topics and and transforme it to dyn string by separating the lines "\n"
//   fopen(sPath + sConnectionName + "_discovered_topics.txt", "r+");
  fileToString(sPath + "discovered_topics.txt", sFile);
  dsFile = strsplit(sFile, "\n");


  // Create the data type
  string DptNameFloat = sConnectionName + "_MQTTTopics_float";
  string DptNameBool = sConnectionName + "_MQTTTopics_bool";
  string DptNameString = sConnectionName + "_MQTTTopics_string";
  xxdepes1[1] = makeDynString(DptNameFloat, "", "", "");
  xxdepes2[1] = makeDynString(DptNameBool, "", "", "");
  xxdepes3[1] = makeDynString(DptNameString, "", "", "");
  // Define the data point elements as unsigned integers
  xxdepei1[1] = makeDynInt(DPEL_FLOAT);
  xxdepei2[1] = makeDynInt(DPEL_BOOL);
  xxdepei3[1] = makeDynInt(DPEL_STRING);

  // Create the data point type if its doesn't already exists
//   for(int i= 1; i<= dynlen(xxdepei);i++)
//   {
  if (!dpTypeExists(DptNameFloat))
  {
    dpTypeCreate(xxdepes1, xxdepei1);
  }

  if (!dpTypeExists(DptNameBool))
  {
    dpTypeCreate(xxdepes2, xxdepei2);
  }

  if (!dpTypeExists(DptNameString))
  {
    dpTypeCreate(xxdepes3, xxdepei3);
  }

//   }

// "_MQTT.Config.DrvNumber:_original"
  int itype = 16;
  int iDriverNum;
  string sConnection = "_" + sConnectionName;
  string sDirection = "/2";
  string sTopicWithDpt ;

  dpGet(sConnection + ".Config.DrvNumber",iDriverNum);

  // Create a data points of the created type - creating the DPs ( MQTT Topics) from the file.
  for (int i = 2; i <= dynlen(dsFile); i++)
  {
    // check first if the Topic does not already exist ( DP)
    sTopicWithDpt = dsFile[i];
    dyn_dyn_string ddsSplit = strsplit(sTopicWithDpt, "\t");
//         DebugN(ddsSplit);
    string sTopic = ddsSplit[1];
    strreplace(sTopic, " ", "_");
    strreplace(sTopic, ".", "_");
    strreplace(sTopic, "-", "_");

    sTopic = sConnectionName + "_" + sTopic;
    if(nameCheck(sTopic, NAMETYPE_DP) == 0)
    {

      if (!dpExists(sTopic) && dsFile[i] != "")
      {
        if (ddsSplit[2] == "boolean")
        {
          dpCreate(sTopic, DptNameBool); // Create the data point
        }
        else if (ddsSplit[2] == "number")
        {
          dpCreate(sTopic, DptNameFloat); // Create the data point
        }
        else if (ddsSplit[2] == "string")
        {
          dpCreate(sTopic, DptNameString); // Create the data point
        }

        delay(0, 5); // just in case of a large file, this delay helps to give time to the next dpSet. and make sure that the DP was created ???

  //        Set the _address configuration for subscription mode
        dpSetWait(sTopic + ".:_distrib.._type", 56,
                  sTopic + ".:_distrib.._driver", iDriverNum,
                  sTopic + ".:_address.._reference", ddsSplit[1],
                  sTopic + ".:_address.._type", itype,
                  sTopic + ".:_address.._connection", sConnection,
                  sTopic + ".:_address.._direction", "\2",
                  sTopic + ".:_address.._datatype", "1001",
                  sTopic + ".:_address.._drv_ident", "MQTT");
      }
    }
  }

  // Call the function to create a new CNS view
  createCNSView(sConnectionName);
}

createCNSView(string &sConnectionName)
{
  dyn_string dsDPTs = dpTypes(sConnectionName + "_MQTTTopics_*");

  dyn_dyn_anytype dsDPE;

  for (int i = 1; i <= dynlen(dsDPTs); i++)
  {
    dpQuery("SELECT '_online.._value' FROM '*' WHERE _DPT =\"" + dsDPTs[i] + "\"", dsDPE);
    dpCreateCNS(dsDPE,sConnectionName);
  }

}
void dpCreateCNS(dyn_dyn_anytype dsDPE, string &sConnectionName)
{
  //Create My View
  langString myLang;
  string sSystemName;

  sSystemName = getSystemName();
  strreplace(sSystemName, ":", "");

  setLangString(myLang, 0, sConnectionName +"_MqttDiscoveredTopics");

  if(!cns_viewExists(sSystemName + "." + sConnectionName + ":"))
  {
    cnsCreateView(sSystemName + "." + sConnectionName + ":", myLang);
  }

  int accessLevel = 10;

  for (int k = 2; k <= dynlen(dsDPE); k++)
  {

    string sTopic = dpSubStr(dsDPE[k][1], DPSUB_DP_EL_CONF_DET_ATT);

    strreplace(sTopic, ".", "");

    dyn_string dsTopicNodes = strsplit(sTopic, "/");
    string sParent = sSystemName + "." + sConnectionName + ":";

    // Create the Lines
    for (int i = 1; i <= dynlen(dsTopicNodes); i++)
    {
      setLangString(myLang, 0, dsTopicNodes[i]);

      if (i == 1)
      {
        if (!cns_nodeExists(sParent + "." + dsTopicNodes[i]))
        {
          cns_createTreeOrNode(sParent, dsTopicNodes[i], myLang, "", CNS_DATATYPE_EMPTY);
        }
      }
      else if (i == dynlen(dsTopicNodes))
      {
        sParent = sParent + dsTopicNodes[i - 1] ;

        if (!cns_nodeExists(sParent + "." + dsTopicNodes[i]))
        {
          cns_createTreeOrNode(sParent, dsTopicNodes[i], myLang, dsDPE[k][1], CNS_DATATYPE_DATAPOINT);
          cnsSetProperty(dsTopicNodes[i], "OA:OPC", accessLevel);
        }
      }
      else
      {
        sParent = sParent + dsTopicNodes[i - 1] ;

        if (!cns_nodeExists(sParent + "." + dsTopicNodes[i]))
        {
          cns_createTreeOrNode(sParent, dsTopicNodes[i], myLang, "", CNS_DATATYPE_EMPTY);
          cnsSetProperty(dsTopicNodes[i], "OA:OPC", accessLevel);
        }

        sParent = sParent + ".";
      }
    }
  }
}

//--------------------------------------------------------------------------------
//@private members
//--------------------------------------------------------------------------------

