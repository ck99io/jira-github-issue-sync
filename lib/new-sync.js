(function sync() {
    var JiraApi = require('jira').JiraApi;
    var GithubApi = require('github');
    var jiraExtension = require('./jira-extension.js');
    var _ = require('underscore');
    var request = require('request');

    // Included for async and await functionality
    var async = require('asyncawait/async');
    var await = require('asyncawait/await');

    var context = {
        ghIssues: [],
        ghClosedIssues: []
    };

    var jiraTypes = [
        'Task', 'Bug', 'Sub-task', 'User Story'
    ];

    var configApis = function configApis(config) {
        var apis = { jira: {} };
        apis.jira.default = new JiraApi(
            config.jira.protocol,
            config.jira.host,
            config.jira.port,
            config.jira.user,
            config.jira.password,
            config.jira.defaultApi.version
        );

        apis.jira.greenhopper = new JiraApi(
            config.jira.protocol,
            config.jira.host,
            config.jira.port,
            config.jira.user,
            config.jira.password,
            config.jira.greenhopper.version
        );
        jiraExtension.extend(apis.jira.greenhopper);

        apis.github = new GithubApi({version: "3.0.0"});
        apis.github.authenticate(config.github.auth);
        return apis;
    };


    // Get the current sprint open in JIRA
    // Check to see if it exists as a milestone in ALL repos
    // If it doesn't exist, make it
    var buildMilestones = function buildMilestones(){
        async (function(){
            var currentSprint = await (getCurrentSprint());
            var operateSprint = await (operateSprint(currentSprint.sprint));
        });
    };

    var operateSprint = function operateSprint(currentSprint){
        _.each(context.config.github.repos, function(repo){
            checkForMilestone(currentSprint, repo);
        });
    };

    // Get the current sprint open in JIRA
    var getCurrentSprint = function getCurrentSprint() {
        context.api.jira.greenhopper.findRapidView(context.config.jira.project, function(error, rapidView) {
            context.rapidView = rapidView;
            context.api.jira.greenhopper.getLastSprintForRapidView(rapidView.id, function(error, sprint) {
                //context.sprint = sprint;
                return {'sprint': sprint, 'rapidView': rapidView};
            });
        });
    };

    // Check for the existence of a milestone in a repo
    // If it exists, print that it exists
    // If it doesn't exist, create it
    var checkForMilestone = function checkForMilestone(sprint, repo){
        var msg = _.extend({
            state:'open',
            repo: repo
        }, context.config.github);
        context.api.github.issues.getAllMilestones(msg, function(error, milestones) {
            var milestone = _.find(milestones, function(milestone) { return milestone.title == sprint.name;});
            if( milestone ) {
//                context.milestone = milestone;
                console.log(' - Exists in repo ' + repo);
            } else {
                console.log(' - Not found in repo ' + repo);
                msg = _.extend({
                    title: sprint.name
                }, msg);
                context.api.github.issues.createMilestone(msg, function(error, result){
                    console.log(' - New milestone created');
                })
            }
        });
    };



    var getGhIssueFor = function getGhIssue(jiraIssue) {
        var match =  _.find(context.ghIssues, function(current) {
            return current.title.match("^" + jiraIssue.key);
        });
        return match;
    };

    var getGhUserFor = function getGhUserFor(jiraUser) {
        var ghuser = context.config.userMapping[jiraUser];
        if(!ghuser) {
            throw new Error("Can't find ghuser for jiraUser:" + jiraUser);
        }
        return ghuser;
    };

    var createGhIssue = function createGhIssue(jiraIssue, callback) {
        context.api.jira.default.findIssue(jiraIssue.key, function getIssue(error, completeIssue) {
            var repo = completeIssue.fields.labels[0];
            if(!repo) {
                repo = context.config.github.repos[0];
            }
            console.log('\t-Created new in repo: ' + repo);
            var args = _.extend({
                assignee: getGhUserFor(jiraIssue.assignee),
                title: (jiraIssue.key + ': ' + jiraIssue.summary).toString('utf8'),
                milestone: context.milestone.number,
                labels: [jiraIssue.typeName, jiraIssue.priorityName]
            });
            var requestArgs = {
                uri: 'https://api.github.com/repos/'+context.config.github.user+'/'+repo+'/issues',
                body: JSON.stringify(args),
                headers: {
                    authorization: 'Basic ' + new Buffer(context.config.github.auth.username + ":" + context.config.github.auth.password, "ascii").toString("base64"),
                    'content-type': 'application/json',
                    'user-agent': 'request'
                }
            };
            request.post(requestArgs, function afterRequest(e, r, body) {
                callback(e, body);
            });
        });
    };

    var validIssueTypeForImport = function validIssueTypeForImport(typeName) {
        var match = _.find(jiraTypes, function finder(jiraType) {return jiraType === typeName; });
        return match !== undefined;
    };

    var generateGithubIssue = function generateGithubIssue(issues, callback, masterCallback) {
        var issue = issues.pop();
        console.log(' - ' + issue.typeName + ':' + issue.key );

        if(validIssueTypeForImport(issue.typeName)) {
            var ghissue = getGhIssueFor(issue);
            if(ghissue) {
                console.log('\t- Already exists');
                generateGithubIssues(issues, null, masterCallback);
            } else {
                createGhIssue(issue, function(error, ghIssueBody) {
                    linkGhSubtasks(issue, ghIssueBody, function () {
                        generateGithubIssues(issues, null, masterCallback);
                    });
                });
            }
        } else {
            console.log('\t- Ignored');
            generateGithubIssues(issues, null, masterCallback);
        }
    };

    var generateGithubIssues = function generateGithubIssues(issues, callback, masterCallback) {
        if(_.isEmpty(issues) ) {
            masterCallback(null);
        } else {
            generateGithubIssue(issues, generateGithubIssues, masterCallback);
        }
    };

    var addJiraSubtasks = function addJiraSubtasks(issue, callback) {
        context.api.jira.default.findIssue(issue.key, function getIssue(error, completeIssue) {
            if(!completeIssue){
                callback(error);
                return;
            }
            _.each(completeIssue.fields.subtasks, function(subtask) {
                subtask.typeName = subtask.fields.issuetype.name;
                subtask.summary = subtask.fields.summary;
                subtask.priorityName = subtask.fields.priority.name;
                subtask.assignee = issue.assignee;
                subtask.__parentId = issue.key;
            });
            context.subIssues = _.union(context.subIssues, completeIssue.fields.subtasks);
            callback(error, completeIssue);
        });
    };

    var createJiraTasksOnGithub = function createJiraTasksOnGithub(callback) {
        context.api.jira.greenhopper.getSprintIssues(context.rapidView.id, context.sprint.id, function(error, result) {
            errorLog(error);
            var masterIssues = _.union(result.contents.completedIssues, result.contents.incompletedIssues);
            context.subIssues = [];

            async.each(masterIssues, addJiraSubtasks, function completed(err) {
                context.jiraOpenIssues = _.union(result.contents.incompletedIssues, context.subIssues);
                var issues = _.union(result.contents.incompletedIssues, context.subIssues); // clone
                console.log('Sprint issues: ' + context.jiraOpenIssues.length);
                generateGithubIssues(issues, null, callback);
            });
        });
    };

    // Get a github parent id by it's jira key
    var getGhParentId = function getGhParentId(key, callback){
        var args = _.extend({
            q: key
        });
        context.api.github.search.issues(args, function(error, body){
            callback(error, body.items[0].number);
        })
    };

    // Adds comments to each subtask relating back to the parent task
    var linkGhSubtasks = function linkGhSubtasks(subtask, ghIssueBody, callback){
        if(!subtask.__parentId){
            return callback(null);
        }
        getGhParentId(subtask.__parentId, function(error, parentId){
            var args = _.extend({
                body: "Related to #" + parentId + " (" + subtask.__parentId + ") as sub-task"
            });

            var requestArgs = {
                uri: JSON.parse(ghIssueBody).comments_url,
                body: JSON.stringify(args),
                headers: {
                    authorization: 'Basic ' + new Buffer(context.config.github.auth.username + ":" + context.config.github.auth.password, "ascii").toString("base64"),
                    'content-type': 'application/json',
                    'user-agent': 'request'
                }
            };

            request.post(requestArgs, function afterRequest(e, r, body){
                callback(e);
            });
        });
    };

    exports.process = function process(config){
        context.config = config;
        context.api = configApis(config);
        // Asyncawait part

        var sync = async (function(){

        });




        async.series([
            buildMilestone,
            getAllSprintIssues,
            getAllClosedSprintIssues,
            createJiraTasksOnGithub,
            closeJiraTasks
        ], errorLog);

    };
})();